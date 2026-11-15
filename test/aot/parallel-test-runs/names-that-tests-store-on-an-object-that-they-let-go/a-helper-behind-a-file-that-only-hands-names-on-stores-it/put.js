export const put = object => { object.__mark = 1; }; export const drop = object => { delete object.__mark; };
