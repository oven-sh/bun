// Says when it is loaded.
console.log("the module of decorators is loaded");

export function dec(..._values: unknown[]): any {
    console.log("dec is called");
    return function () {};
}

export const name = "named";
