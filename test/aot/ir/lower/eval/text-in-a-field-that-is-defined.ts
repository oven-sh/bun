// RUN: link
// CHECK: evalscope {{*}}bindings=[{kind=HomeObject {{*}}}, {name="Defined" kind=Constant

export class Defined {
  x: any = eval("given");
  constructor(given: string) {}
}
