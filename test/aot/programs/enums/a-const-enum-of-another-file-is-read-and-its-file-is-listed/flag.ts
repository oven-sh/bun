export const enum Flag {
  None,
  Read = 1 << 0,
  Write = 1 << 1,
  Both = Read | Write,
}
