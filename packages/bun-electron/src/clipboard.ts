// clipboard — Electron-compatible clipboard.
//
// CEF does not expose a clipboard C API, and a headless Linux box has no
// system clipboard, so this is a process-local clipboard: it implements the
// full read/write/format API and is consistent within the app. (A real OS
// clipboard bridge would replace the backing store; the API would not change.)

interface ClipboardStore {
  text: string;
  html: string;
  rtf: string;
  image: Buffer | null;
  bookmark: { title: string; url: string } | null;
}

const store: ClipboardStore = {
  text: "",
  html: "",
  rtf: "",
  image: null,
  bookmark: null,
};

export const clipboard = {
  readText(_type?: string): string {
    return store.text;
  },

  writeText(text: string, _type?: string): void {
    store.text = String(text);
  },

  readHTML(_type?: string): string {
    return store.html;
  },

  writeHTML(markup: string, _type?: string): void {
    store.html = String(markup);
  },

  readRTF(_type?: string): string {
    return store.rtf;
  },

  writeRTF(text: string, _type?: string): void {
    store.rtf = String(text);
  },

  readBookmark(): { title: string; url: string } {
    return store.bookmark ?? { title: "", url: "" };
  },

  writeBookmark(title: string, url: string, _type?: string): void {
    store.bookmark = { title: String(title), url: String(url) };
  },

  write(data: { text?: string; html?: string; rtf?: string; bookmark?: string }, _type?: string): void {
    if (data.text !== undefined) store.text = String(data.text);
    if (data.html !== undefined) store.html = String(data.html);
    if (data.rtf !== undefined) store.rtf = String(data.rtf);
  },

  availableFormats(_type?: string): string[] {
    const formats: string[] = [];
    if (store.text) formats.push("text/plain");
    if (store.html) formats.push("text/html");
    if (store.rtf) formats.push("text/rtf");
    if (store.image) formats.push("image/png");
    return formats;
  },

  has(format: string, _type?: string): boolean {
    return this.availableFormats().includes(format);
  },

  clear(_type?: string): void {
    store.text = "";
    store.html = "";
    store.rtf = "";
    store.image = null;
    store.bookmark = null;
  },
};
