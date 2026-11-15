import { Level, State } from "./kinds";

export function readsBeforeItIsMade(list: number[]): string {
  let text = "";
  for (let i = 0; i < list.length; i++) {
    try {
      text += list[i] === State.Ready ? "ready " : "no ";
    } catch (error) {
      text += (error as Error).name + " ";
    }
  }
  return text;
}
export function count(list: number[]): number {
  let found = 0;
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    if (value === State.Ready) found++;
    else if (value === State.Done) found += 10;
    else if (value === Level.Low) found += 100;
  }
  return found;
}
export function countsBeforeItIsMade(list: number[]): string {
  try {
    return String(count(list));
  } catch (error) {
    return (error as Error).name;
  }
}
