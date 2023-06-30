/*
 * Copyright 2023 Codeblog Corp. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
export function getEventSource() {
  type Socket = Awaited<ReturnType<typeof Bun.connect<EventSource>>>;

  class EventSource extends EventTarget {
    #url;
    #state;
    #onerror;
    #onmessage;
    #onopen;
    #is_tls = false;
    #socket: Socket | null = null;
    #data_buffer = "";
    #send_buffer = "";
    #lastEventID = "";
    #reconnect = true;
    #content_length = 0; // 0 means chunked -1 means not informed aka no auto end
    #received_length = 0;
    #reconnection_time = 0;
    #reconnection_timer: Timer | null = null;

    static #ConnectNextTick(self: EventSource) {
      self.#connect();
    }
    static #SendRequest(socket: Socket, url: URL) {
      const self = socket.data;
      const last_event_header = self.#lastEventID ? `Last-Event-ID: ${self.#lastEventID}\r\n` : "";
      const request = `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: bun\r\nContent-type: text/event-stream\r\nContent-length: 0\r\n${last_event_header}\r\n`;
      const sended = socket.write(request);
      if (sended !== request.length) {
        self.#send_buffer = request.substring(sended);
      }
    }

    static #ProcessChunk(self: EventSource, chunks: string, offset: number) {
      for (;;) {
        if (offset >= chunks.length) {
          return;
        }
        let chunk_end_idx = -1;
        let start_idx = chunks.indexOf("\r\n", offset);
        const chunk_start_idx = start_idx + 2;
        if (start_idx > 0) {
          if (self.#content_length === 0) {
            const chunk_size = parseInt(chunks.substring(offset, start_idx), 16);
            if (chunk_size === 0) {
              // no more chunks
              self.#state = 2;
              self.#socket?.end();
              return;
            }
            chunk_end_idx = chunk_start_idx + chunk_size;
          } else {
            //not chunked
            chunk_end_idx = chunks.length;
          }
        } else {
          // wait for the chunk if is chunked
          if (self.#data_buffer.length === 0) {
            self.#data_buffer += chunks.substring(offset);
            return;
          }
          chunk_end_idx = chunks.length;
        }

        // check for chunk end
        let chunk = chunks.substring(chunk_start_idx, chunk_end_idx);
        offset = chunk_end_idx + 2;
        let chunk_offset = 0;
        // wait for data end
        let event_idx = chunk.indexOf("\n\n");
        if (event_idx == -1) {
          // wait for more data
          self.#data_buffer += chunks.substring(chunk_start_idx);
          return;
        }

        // combine data
        if (self.#data_buffer.length) {
          self.#data_buffer += chunk;
          chunk = self.#data_buffer;
          self.#data_buffer = "";
        }

        let more_events = true;
        while (more_events) {
          const event_data = chunk.substring(chunk_offset, event_idx);

          let type;
          let data = "";
          let id;
          let event_line_idx = 0;
          let retry = -1;
          for (;;) {
            let idx = event_data.indexOf("\n", event_line_idx);
            if (idx === -1) {
              if (event_line_idx >= event_data.length) {
                break;
              }
              idx = event_data.length;
            }
            const line = event_data.substring(event_line_idx, idx);
            if (line.startsWith("data:")) {
              if (data.length) {
                data += `\n${line.substring(5).trim()}`;
              } else {
                data = line.substring(5).trim();
              }
            } else if (line.startsWith("event:")) {
              type = line.substring(6).trim();
            } else if (line.startsWith("id:")) {
              id = line.substring(3).trim();
            } else if (line.startsWith("retry:")) {
              retry = parseInt(line.substring(6).trim(), 10);
              if (isNaN(retry)) {
                retry = -1;
              }
            }
            event_line_idx = idx + 1;
          }
          self.#lastEventID = id || "";
          if (retry >= 0) {
            self.#reconnection_time = retry;
          }

          if (data || id || type) {
            self.dispatchEvent(
              new MessageEvent(type || "message", {
                data: data || "",
                origin: self.#url.origin,
                // @ts-ignore
                source: self,
                lastEventId: id,
              }),
            );
          }

          // no more events
          if (chunk.length === event_idx + 2) {
            more_events = false;
            break;
          }

          const next_event_idx = chunk.indexOf("\n\n", event_idx + 1);
          if (next_event_idx === -1) {
            break;
          }
          chunk_offset = event_idx;
          event_idx = next_event_idx;
        }
      }
    }
    static #Handlers = {
      open(socket: Socket) {
        const self = socket.data;
        self.#socket = socket;
        if (!self.#is_tls) {
          EventSource.#SendRequest(socket, self.#url);
        }
      },
      handshake(socket: Socket, success: boolean, verifyError: Error) {
        const self = socket.data;
        if (success) {
          EventSource.#SendRequest(socket, self.#url);
        } else {
          self.#state = 2;
          self.dispatchEvent(new ErrorEvent("error", { error: verifyError }));
          socket.end();
        }
      },
      data(socket: Socket, buffer: Buffer) {
        const self = socket.data;
        switch (self.#state) {
          case 0: {
            let text = buffer.toString();
            const headers_idx = text.indexOf("\r\n\r\n");
            if (headers_idx === -1) {
              // wait headers
              self.#data_buffer += text;
              return;
            }

            if (self.#data_buffer.length) {
              self.#data_buffer += text;
              text = self.#data_buffer;
              self.#data_buffer = "";
            }
            const headers = text.substring(0, headers_idx);
            const status_idx = headers.indexOf("\r\n");

            if (status_idx === -1) {
              self.#state = 2;
              self.dispatchEvent(new ErrorEvent("error", { error: new Error("Invalid HTTP request") }));
              socket.end();
              return;
            }
            const status = headers.substring(0, status_idx);
            if (status !== "HTTP/1.1 200 OK") {
              self.#state = 2;
              self.dispatchEvent(new ErrorEvent("error", { error: new Error(status) }));
              socket.end();
              return;
            }

            let start_idx = status_idx + 1;
            let mime_type_ok = false;
            let content_length = -1;
            for (;;) {
              let header_idx = headers.indexOf("\r\n", start_idx);
              // No text/event-stream mime type
              if (header_idx === -1) {
                if (start_idx >= headers.length) {
                  if (!mime_type_ok) {
                    self.#state = 2;
                    self.dispatchEvent(
                      new ErrorEvent("error", {
                        error: new Error(
                          `EventSource's response has no MIME type and "text/event-stream" is required. Aborting the connection.`,
                        ),
                      }),
                    );
                    socket.end();
                  }
                  return;
                }

                header_idx = headers.length;
              }

              const header = headers.substring(start_idx + 1, header_idx);
              const header_name_idx = header.indexOf(":");
              const header_name = header.substring(0, header_name_idx);
              const is_content_type =
                header_name.localeCompare("content-type", undefined, { sensitivity: "accent" }) === 0;
              start_idx = header_idx + 1;

              if (is_content_type) {
                if (header.endsWith(" text/event-stream")) {
                  mime_type_ok = true;
                } else {
                  // wrong mime type
                  self.#state = 2;
                  self.dispatchEvent(
                    new ErrorEvent("error", {
                      error: new Error(
                        `EventSource's response has a MIME type that is not "text/event-stream". Aborting the connection.`,
                      ),
                    }),
                  );
                  socket.end();
                  return;
                }
              } else {
                const is_content_length =
                  header_name.localeCompare("content-length", undefined, { sensitivity: "accent" }) === 0;
                if (is_content_length) {
                  content_length = parseInt(header.substring(header_name_idx + 1).trim(), 10);
                  if (isNaN(content_length) || content_length <= 0) {
                    self.dispatchEvent(
                      new ErrorEvent("error", {
                        error: new Error(`EventSource's Content-Length is invalid. Aborting the connection.`),
                      }),
                    );
                    socket.end();
                    return;
                  }
                  if (mime_type_ok) {
                    break;
                  }
                } else {
                  const is_transfer_encoding =
                    header_name.localeCompare("transfer-encoding", undefined, { sensitivity: "accent" }) === 0;
                  if (is_transfer_encoding) {
                    if (header.substring(header_name_idx + 1).trim() !== "chunked") {
                      self.dispatchEvent(
                        new ErrorEvent("error", {
                          error: new Error(`EventSource's Transfer-Encoding is invalid. Aborting the connection.`),
                        }),
                      );
                      socket.end();
                      return;
                    }
                    content_length = 0;
                    if (mime_type_ok) {
                      break;
                    }
                  }
                }
              }
            }

            self.#content_length = content_length;
            self.#state = 1;
            self.dispatchEvent(new Event("open"));
            const chunks = text.substring(headers_idx + 4);
            EventSource.#ProcessChunk(self, chunks, 0);
            if (self.#content_length > 0) {
              self.#received_length += chunks.length;
              if (self.#received_length >= self.#content_length) {
                self.#state = 2;
                socket.end();
              }
            }
            return;
          }
          case 1:
            EventSource.#ProcessChunk(self, buffer.toString(), 2);
            if (self.#content_length > 0) {
              self.#received_length += buffer.byteLength;
              if (self.#received_length >= self.#content_length) {
                self.#state = 2;
                socket.end();
              }
            }
            return;
          default:
            break;
        }
      },
      drain(socket: Socket) {
        const self = socket.data;
        if (self.#state === 0) {
          const request = self.#data_buffer;
          if (request.length) {
            const sended = socket.write(request);
            if (sended !== request.length) {
              socket.data.#send_buffer = request.substring(sended);
            } else {
              socket.data.#send_buffer = "";
            }
          }
        }
      },
      close: EventSource.#Close,
      end(socket: Socket) {
        EventSource.#Close(socket).dispatchEvent(
          new ErrorEvent("error", { error: new Error("Connection closed by server") }),
        );
      },
      timeout(socket: Socket) {
        EventSource.#Close(socket).dispatchEvent(new ErrorEvent("error", { error: new Error("Timeout") }));
      },
      binaryType: "buffer",
    };

    static #Close(socket: Socket) {
      const self = socket.data;
      self.#socket = null;
      self.#received_length = 0;
      self.#state = 2;
      if (self.#reconnect) {
        if (self.#reconnection_timer) {
          clearTimeout(self.#reconnection_timer);
        }
        self.#reconnection_timer = setTimeout(EventSource.#ConnectNextTick, self.#reconnection_time, self);
      }
      return self;
    }
    constructor(url: string, options = undefined) {
      super();
      const uri = new URL(url);
      this.#is_tls = uri.protocol === "https:";
      this.#url = uri;
      this.#state = 2;
      process.nextTick(EventSource.#ConnectNextTick, this);
    }

    // Not web standard
    ref() {
      this.#reconnection_timer?.ref();
      this.#socket?.ref();
    }

    // Not web standard
    unref() {
      this.#reconnection_timer?.unref();
      this.#socket?.unref();
    }

    #connect() {
      if (this.#state !== 2) return;
      const uri = this.#url;
      const is_tls = this.#is_tls;
      this.#state = 0;
      //@ts-ignore
      Bun.connect({
        data: this,
        socket: EventSource.#Handlers,
        hostname: uri.hostname,
        port: parseInt(uri.port || (is_tls ? "443" : "80"), 10),
        tls: is_tls
          ? {
              requestCert: true,
              rejectUnauthorized: false,
            }
          : false,
      }).catch(err => {
        super.dispatchEvent(new ErrorEvent("error", { error: err }));
        if (this.#reconnect) {
          if (this.#reconnection_timer) {
            this.#reconnection_timer.unref?.();
          }

          this.#reconnection_timer = setTimeout(EventSource.#ConnectNextTick, 1000, this);
        }
      });
    }

    get url() {
      return this.#url.href;
    }

    get readyState() {
      return this.#state;
    }

    close() {
      this.#reconnect = false;
      this.#state = 2;
      this.#socket?.unref();
      this.#socket?.end();
    }

    get onopen() {
      return this.#onopen;
    }
    get onerror() {
      return this.#onerror;
    }
    get onmessage() {
      return this.#onmessage;
    }

    set onopen(cb) {
      if (this.#onopen) {
        super.removeEventListener("close", this.#onopen);
      }
      super.addEventListener("open", cb);
      this.#onopen = cb;
    }

    set onerror(cb) {
      if (this.#onerror) {
        super.removeEventListener("error", this.#onerror);
      }
      super.addEventListener("error", cb);
      this.#onerror = cb;
    }

    set onmessage(cb) {
      if (this.#onmessage) {
        super.removeEventListener("message", this.#onmessage);
      }
      super.addEventListener("message", cb);
      this.#onmessage = cb;
    }
  }

  Object.defineProperty(EventSource.prototype, "CONNECTING", {
    enumerable: true,
    value: 0,
  });

  Object.defineProperty(EventSource.prototype, "OPEN", {
    enumerable: true,
    value: 1,
  });

  Object.defineProperty(EventSource.prototype, "CLOSED", {
    enumerable: true,
    value: 2,
  });

  EventSource[Symbol.for("CommonJS")] = 0;

  return EventSource;
}
