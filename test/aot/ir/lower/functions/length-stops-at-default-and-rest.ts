// RUN(DEFAULT): lower
// DEFAULT: function {{*}}name="withDefault"{{*}} length=1 thisType=

// RUN(REST): lower
// REST: function {{*}}name="withRest"{{*}} length=1 thisType=

// RUN(ALL): lower
// ALL: function {{*}}name="withoutEither"{{*}} length=3 thisType=

// RUN(NONE): lower
// NONE-NOT: name="firstDefault"{{*}}length=

export function withDefault(a: number, b = 1, c: number) {}

export function withRest(a: number, ...rest: number[]) {}

export function withoutEither(a: number, b: number, c: number) {}

export function firstDefault(a = 1) {}
