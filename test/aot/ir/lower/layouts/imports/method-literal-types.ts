export interface Context {
  n: number;
}
export type Call = (done: () => void, context: Context) => Promise<number>;
export interface Module {
  call: Call;
}
export interface Command {
  name: string;
  load: () => Promise<Module>;
}
