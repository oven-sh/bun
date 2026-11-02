import { parts } from "esmkit";
import triple = parts.triple;
import turn = parts.turn;
parts.next();
console.log(triple(2), turn, parts.turn);
