import { a, g, ag } from "./kinds-a.js";
export const seen = [typeof a().then, [...g()].join(), typeof ag().next, a.constructor.name, g.constructor.name, ag.constructor.name].join();
