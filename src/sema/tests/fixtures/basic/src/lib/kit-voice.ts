export type Voice = { say(text: string): void };
declare module "./kit" {
  interface Engine {
    voice: Voice;
  }
  interface State {
    open: boolean;
  }
}
