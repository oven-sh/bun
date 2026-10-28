export enum Flags {
  Read = 1,
  Write = 2,
  "not a name" = 4,
  Both = Flags["Read"] | Flags[`Write`],
  All = Flags.Both | Flags["not a name"],
}
