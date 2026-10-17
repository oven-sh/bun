import * as Late from './late'
export function tooEarly() { try { return Late.answer() } catch (e) { return e instanceof ReferenceError ? 'ReferenceError' : 'other ' + e } }
export const seen = tooEarly()
