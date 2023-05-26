class EventSource extends EventTarget {
  #url;
  #state;
  #onerror;
  #onmessage;
  #onopen;
  #is_tls = false;
  #socket = null;
  #data_buffer = "";
  #send_buffer = "";
  #lastEventID = "";

  static #SendRequest(socket, url) {
    const request = `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: bun\r\nContent-type: text/event-stream\r\nContent-length: 0\r\n\r\n`;
    const sended = socket.write(request);
    if (sended !== request.length) {
      socket.data.#send_buffer = request.substring(sended);
    }
  }

  static #ProcessChunk(self, chunk, offset) {
    let start_idx = chunk.indexOf("\r\n", offset);
    // wait for the chunk
    if (start_idx === -1 && self.#data_buffer.length === 0) {
      self.#data_buffer += chunk;
      return;
    }
    // wait for data end
    let event_idx = chunk.indexOf("\n\n");
    if (event_idx == -1) {
      // wait for more data
      self.#data_buffer += chunk;
      return;
    }

    // combine data
    if (self.#data_buffer.length) {
      self.#data_buffer += chunk;
      chunk = self.#data_buffer;
      self.#data_buffer = "";
    }

    for (;;) {
      const event_data = chunk.substring(start_idx + 2, event_idx);

      let type;
      let data = "";
      let id;
      let event_line_idx = 0;
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
        }
        event_line_idx = idx + 1;
      }
      self.#lastEventID = id || "";

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
        return;
      }

      const next_event_idx = chunk.indexOf("\n\n", event_idx + 1);
      if (next_event_idx === -1) {
        // wait for more data
        self.#data_buffer = chunk.substring(event_idx + 1);
        return;
      }
      start_idx = event_idx;
      event_idx = next_event_idx;
    }
  }
  static #Handlers = {
    open(socket) {
      const self = socket.data;
      self.#socket = socket;
      if (!self.#is_tls) {
        EventSource.#SendRequest(socket, self.#url);
      }
    },
    handshake(socket, success, verifyError) {
      const self = socket.data;
      if (success) {
        EventSource.#SendRequest(socket, self.#url);
      } else {
        self.#state = 2;
        self.dispatchEvent(new ErrorEvent("error", { error: verifyError }));
        socket.end();
      }
    },
    data(socket, buffer) {
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
          for (;;) {
            const header_idx = headers.indexOf("\r\n", start_idx);
            // No text/event-stream mime type
            if (header_idx === -1) {
              self.#state = 2;
              self.dispatchEvent(
                new ErrorEvent("error", {
                  error: new Error(
                    `EventSource's response has no MIME type and "text/event-stream" is required. Aborting the connection.`,
                  ),
                }),
              );
              socket.end();
              return;
            }

            const header = headers.substring(start_idx, header_idx);
            const header_name = header.substring(1, header.indexOf(":"));
            const is_content_type =
              header_name.localeCompare("content-type", undefined, { sensitivity: "accent" }) === 0;
            start_idx = header_idx + 1;
            if (is_content_type) {
              if (header.endsWith(" text/event-stream")) {
                // mime type check ok
                break;
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
            }
          }
          self.#state = 1;
          self.dispatchEvent(new Event("open"));
          const chunks = text.substring(headers_idx + 4);
          EventSource.#ProcessChunk(self, chunks, 0);

          return;
        }
        case 1:
          EventSource.#ProcessChunk(self, buffer.toString(), 2);

          return;
        default:
          break;
      }
    },
    drain(socket) {
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
    end(socket) {
      EventSource.#Close(socket).dispatchEvent(
        new ErrorEvent("error", { error: new Error("Connection closed by server") }),
      );
    },
    timeout(socket) {
      EventSource.#Close(socket).dispatchEvent(new ErrorEvent("error", { error: new Error("Timeout") }));
    },
    binaryType: "buffer",
  };
  static #Close(socket) {
    const self = socket.data;
    self.#socket = null;
    self.#state = 2;
    return self;
  }
  constructor(url, options = undefined) {
    super();
    const uri = new URL(url);
    const is_tls = uri.protocol === "https:";
    this.#is_tls = is_tls;
    this.#url = uri;
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
    }).catch(err => this.dispatchEvent(new ErrorEvent("error", { error: err })));
  }

  get url() {
    return this.#url.href;
  }

  get readyState() {
    return this.#state;
  }

  close() {
    this.#state = 2;
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
      this.removeEventListener("close", this.#onopen);
    }
    this.addEventListener("open", cb);
    this.#onopen = cb;
  }

  set onerror(cb) {
    if (this.#onerror) {
      this.removeEventListener("error", this.#onerror);
    }
    this.addEventListener("error", cb);
    this.#onerror = cb;
  }

  set onmessage(cb) {
    if (this.#onmessage) {
      this.removeEventListener("message", this.#onmessage);
    }
    this.addEventListener("message", cb);
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
export default EventSource;
