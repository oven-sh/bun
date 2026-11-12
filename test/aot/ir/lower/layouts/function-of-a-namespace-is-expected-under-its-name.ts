// `(N as any).f = g`: the name `f` stays bound to the function that is declared. The property of the object does not, so of the field the function is what is expected.
// RUN(FIELD): link
// FIELD: layout {{*}}kind=Container name="N" {{*}}fields=[{key="f" declared={type=f{{*}} flags=[IsFromCompiler, IsExpected]}}, {key="v" declared={type=number}}]

export namespace N {
  export function f(): number {
    return 1;
  }
  export let v: number = f();
}
