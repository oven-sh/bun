// RUN: link
// CHECK: layout [[environment]] kind=Environment {{*}}variableName="given"
// CHECK: evalscope {{*}}{name="given" depth={{*}} layout=[[environment]] field=0 operand=

// FILE: main.ts
export class Assigned {
  x: any = eval("given");
  constructor(given: string) {}
}

// FILE: tsconfig.json
{ "compilerOptions": { "useDefineForClassFields": false } }
