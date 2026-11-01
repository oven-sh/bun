import { test } from "../../../../../harness/declare";
export function say(file: string, name: string, body: () => unknown): void {
  test(name, async () => { let text: string; try { text = JSON.stringify(await body()); } catch (error) { text = "THROWS " + (error as Error).name + ": " + String((error as Error).message).split("/").pop()!.slice(0, 60); } console.log("SEEN|" + file + "|" + name + "|" + text); });
}
export const helperState = { loaded: 0 };
helperState.loaded++;
