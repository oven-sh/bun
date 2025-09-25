declare module "bun" {
  interface Clipboard {
    /**
     * Writes text to the system clipboard
     * @param text The text to write to the clipboard
     * @returns A promise that resolves when the text is written
     */
    writeText(text: string): Promise<void>;

    /**
     * Reads text from the system clipboard
     * @returns A promise that resolves with the clipboard text
     */
    readText(): Promise<string>;
  }

  const clipboard: Clipboard;
}