import toolbox = require('./toolbox')
declare module './toolbox' {
  interface Static {
    twice(n: number): [number, number]
  }
}
