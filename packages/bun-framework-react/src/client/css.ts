export class BakeCSSManager {
  private readonly td = new TextDecoder();

  // It is the framework's responsibility to ensure that client-side navigation
  // loads CSS files. The implementation here loads all CSS files as <link> tags,
  // and uses the ".disabled" property to enable/disable them.
  private readonly cssFiles = new Map<string, { promise: Promise<void> | null; link: HTMLLinkElement }>();
  private currentCssList: string[] | null = null;

  public async set(list: string[]): Promise<void> {
    this.currentCssList = list;
    await this.ensureCssIsReady(this.currentCssList);
  }

  /**
   * Get the actual list instance. Mutating this list will update the current
   * CSS list (it is the actual array).
   */
  public getList(): string[] {
    return (this.currentCssList ??= []);
  }

  public clear(): void {
    this.currentCssList = [];
  }

  public push(href: string): void {
    const arr = this.getList();
    arr.push(href);
  }

  /** This function blocks until all CSS files are loaded. */
  ensureCssIsReady(cssList: string[] = this.currentCssList ?? []): Promise<void[]> | void {
    const wait: Promise<void>[] = [];

    for (const href of cssList) {
      const existing = this.cssFiles.get(href);

      if (existing) {
        const { promise, link } = existing;

        if (promise) {
          wait.push(promise);
        }

        link.disabled = false;
      } else {
        const link = document.createElement("link");
        let entry: { promise: Promise<void> | null; link: HTMLLinkElement };

        const promise = new Promise<void>((resolve, reject) => {
          link.rel = "stylesheet";
          link.onload = resolve.bind(null, undefined);
          link.onerror = reject;
          link.href = href;
          document.head.appendChild(link);
        }).finally(() => {
          entry.promise = null;
        });

        entry = { promise, link };
        this.cssFiles.set(href, entry);
        wait.push(promise);
      }
    }

    if (wait.length === 0) {
      return;
    }

    return Promise.all(wait);
  }

  public disableUnusedCssFilesIfNeeded(): void {
    if (this.currentCssList) {
      this.disableUnusedCssFiles();
    }
  }

  disableUnusedCssFiles(): void {
    // TODO: create a list of files that should be updated instead of a full loop
    for (const [href, { link }] of this.cssFiles) {
      if (!this.currentCssList!.includes(href)) {
        link.disabled = true;
      }
    }
  }

  async readCssMetadata(
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    let reader: ReadableStreamBYOBReader;

    try {
      // Using BYOB reader allows reading an exact amount of bytes, which allows
      // passing the stream to react without creating a wrapped stream.
      reader = stream.getReader({ mode: "byob" });
    } catch (e) {
      return this.readCssMetadataFallback(stream);
    }

    const header = (await reader.read(new Uint32Array(1))).value;
    if (!header) {
      if (import.meta.env.DEV) {
        throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
      } else {
        location.reload();
      }
    }

    const first = header?.[0];
    if (first !== undefined && first > 0) {
      const cssRaw = (await reader.read(new Uint8Array(first))).value;
      if (!cssRaw) {
        if (import.meta.env.DEV) {
          throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
        } else {
          location.reload();
        }
      }

      this.set(this.td.decode(cssRaw).split("\n"));
    } else {
      this.clear();
    }
    reader.releaseLock();
    return stream;
  }

  /**
   * Like readCssMetadata, but does NOT mutate the current CSS list. It returns
   * the remaining stream after consuming the CSS header and the parsed list of
   * CSS hrefs so callers can preload styles without switching the active list.
   */
  async readCssMetadataForPrefetch(
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<{ stream: ReadableStream<Uint8Array<ArrayBuffer>>; list: string[] }> {
    let reader: ReadableStreamBYOBReader;

    try {
      reader = stream.getReader({ mode: "byob" });
    } catch (e) {
      const s = await this.readCssMetadataFallbackForPrefetch(stream);
      return { stream: s.stream, list: s.list };
    }

    const header = (await reader.read(new Uint32Array(1))).value;
    if (!header) {
      if (import.meta.env.DEV) {
        throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
      } else {
        location.reload();
      }
    }

    const first = header?.[0];
    let list: string[] = [];
    if (first !== undefined && first > 0) {
      const cssRaw = (await reader.read(new Uint8Array(first))).value;
      if (!cssRaw) {
        if (import.meta.env.DEV) {
          throw new Error("Did not read all bytes! This is a bug in bun-framework-react");
        } else {
          location.reload();
        }
      }

      list = this.td.decode(cssRaw).split("\n");
    }
    reader.releaseLock();
    return { stream, list };
  }

  // Prefetch fallback variant that does not mutate currentCssList.
  async readCssMetadataFallbackForPrefetch(
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<{ stream: ReadableStream<Uint8Array<ArrayBuffer>>; list: string[] }> {
    const reader = stream.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalBytes = 0;
    const readChunk = async (size: number) => {
      while (totalBytes < size) {
        const { value, done } = await reader.read();
        if (!done) {
          chunks.push(value);
          totalBytes += value.byteLength;
        } else if (totalBytes < size) {
          if (import.meta.env.DEV) {
            throw new Error("Not enough bytes, expected " + size + " but got " + totalBytes);
          } else {
            location.reload();
          }
        }
      }
      if (chunks.length === 1) {
        const first = chunks[0]!;
        if (first.byteLength >= size) {
          chunks[0] = first.subarray(size);
          totalBytes -= size;
          return first.subarray(0, size);
        } else {
          chunks.length = 0;
          totalBytes = 0;
          return first;
        }
      } else {
        const buffer = new Uint8Array(size);
        let i = 0;
        let chunk: Uint8Array<ArrayBuffer> | undefined;
        let len;
        while (size > 0) {
          chunk = chunks.shift();
          if (!chunk) continue;
          const { byteLength } = chunk;
          len = Math.min(byteLength, size);
          buffer.set(len === byteLength ? chunk : chunk.subarray(0, len), i);
          i += len;
          size -= len;
        }

        if (chunk !== undefined && len !== undefined && chunk.byteLength > len) {
          chunks.unshift(chunk.subarray(len));
        }

        totalBytes -= size;
        return buffer;
      }
    };

    const header = new Uint32Array(await readChunk(4))[0];
    let list: string[] = [];

    if (header === 0) {
      list = [];
    } else if (header !== undefined) {
      list = this.td.decode(await readChunk(header)).split("\n");
    }

    if (chunks.length === 0) {
      return { stream, list };
    }

    // New readable stream that includes the remaining data
    const remainingStream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return { stream: remainingStream, list };
  }
  // Safari does not support BYOB reader. When this is resolved, this fallback
  // should be kept for a few years since Safari on iOS is versioned to the OS.
  // https://bugs.webkit.org/show_bug.cgi?id=283065
  async readCssMetadataFallback(
    stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    const reader = stream.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let totalBytes = 0;
    const readChunk = async (size: number) => {
      while (totalBytes < size) {
        const { value, done } = await reader.read();
        if (!done) {
          chunks.push(value);
          totalBytes += value.byteLength;
        } else if (totalBytes < size) {
          if (import.meta.env.DEV) {
            throw new Error("Not enough bytes, expected " + size + " but got " + totalBytes);
          } else {
            location.reload();
          }
        }
      }
      if (chunks.length === 1) {
        const first = chunks[0]!;
        if (first.byteLength >= size) {
          chunks[0] = first.subarray(size);
          totalBytes -= size;
          return first.subarray(0, size);
        } else {
          chunks.length = 0;
          totalBytes = 0;
          return first;
        }
      } else {
        const buffer = new Uint8Array(size);
        let i = 0;
        let chunk: Uint8Array<ArrayBuffer> | undefined;
        let len;
        while (size > 0) {
          chunk = chunks.shift();
          if (!chunk) continue;
          const { byteLength } = chunk;
          len = Math.min(byteLength, size);
          buffer.set(len === byteLength ? chunk : chunk.subarray(0, len), i);
          i += len;
          size -= len;
        }

        if (chunk !== undefined && len !== undefined && chunk.byteLength > len) {
          chunks.unshift(chunk.subarray(len));
        }

        totalBytes -= size;
        return buffer;
      }
    };

    const header = new Uint32Array(await readChunk(4))[0];

    if (header === 0) {
      this.clear();
    } else if (header !== undefined) {
      this.set(this.td.decode(await readChunk(header)).split("\n"));
    }

    if (chunks.length === 0) {
      return stream;
    }

    // New readable stream that includes the remaining data
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
        }
      },
      cancel() {
        reader.cancel();
      },
    });
  }
}
