import * as Late from './late'
export function tooEarly(): string {
  try {
    class Hasty extends Late.Root {}
    return 'made ' + new Hasty().value
  } catch (e) {
    return e instanceof ReferenceError ? 'ReferenceError' : 'other ' + e
  }
}
export const seen = tooEarly()
