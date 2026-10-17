import { seen } from './early'
export class Root {
  value = 7
}
export class Derived extends Root {}
export const early = () => seen
