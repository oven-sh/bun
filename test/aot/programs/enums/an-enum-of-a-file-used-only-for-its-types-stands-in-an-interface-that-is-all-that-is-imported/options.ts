enum Flags {
  Read = 1,
  Write = 2,
  All = Flags.Read | Flags.Write,
}
export interface Options {
  name: string;
  flags: Flags;
}
