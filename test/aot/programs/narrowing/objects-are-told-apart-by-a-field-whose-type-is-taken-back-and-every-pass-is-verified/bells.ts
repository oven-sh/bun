type Low = { tone: "low"; depth: number };
type Mute = { tone?: undefined; hush: number };

export function toBell(
  note: Low | Mute | { tone: "mid" | "high"; shine: number },
  rings: number,
): { tone: "mid" | "high"; rings: number } | undefined {
  switch (note.tone) {
    case "low":
    case undefined:
      return undefined;
    default:
      return { tone: note.tone, rings };
  }
}
