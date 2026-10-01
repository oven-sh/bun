export = toolbox
declare const toolbox: toolbox.Static
declare namespace toolbox {
  interface Static {
    once<T extends (...args: any) => any>(f: T): T & { called: boolean }
    version: string
  }
  interface Extra {
    n: number
  }
}
