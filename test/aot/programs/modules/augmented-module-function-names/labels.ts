import type { Labeled } from './shapes'

declare module './shapes' {
  interface Labeled {
    label: string
  }
}

export const labelOf = (value: Labeled) => value.label
