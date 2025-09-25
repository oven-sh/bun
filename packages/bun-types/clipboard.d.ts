declare module "bun" {
  interface Clipboard {
    /**
     * Writes text to the system clipboard
     * @param text The text to write to the clipboard
     */
    writeText(text: string): void;

    /**
     * Reads text from the system clipboard
     * @returns The clipboard text
     */
    readText(): string;
  }

  const clipboard: Clipboard;
}
