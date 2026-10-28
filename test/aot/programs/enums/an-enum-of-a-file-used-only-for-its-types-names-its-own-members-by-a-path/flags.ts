export enum Flags {
  None = 0,
  Read = 1 << 0,
  Write = 1 << 1,
  All = Flags.Read | Flags.Write,
}
