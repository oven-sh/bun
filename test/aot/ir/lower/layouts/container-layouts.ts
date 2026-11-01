// RUN(ENUM): link
// ENUM: layout {{*}}kind=Container name="E" {{*}}fields=[{key="A" declared={type={{*}}}}, {key="B" declared={type={{*}}}}]

// RUN(NAMESPACE): link
// NAMESPACE: layout {{*}}kind=Container name="N" {{*}}fields=[{key="v" declared={type={{*}}}}]

// RUN(ABSENT): link
// ABSENT-NOT: layout {{*}}name="E"{{*}}key="0"
// ABSENT-NOT: layout {{*}}name="N"{{*}}key="T"

export enum E {
  A,
  B = "x",
}

export namespace N {
  export const v = 1;
  export type T = number;
}
