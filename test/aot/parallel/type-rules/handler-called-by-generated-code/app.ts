import { compose, get, handlers } from "./library";
get(({ path }) => path);
console.log(compose(handlers[0]!)());
