import "./early";
import { count } from "./a";
export function look(flag: boolean) { let first: unknown = "-"; try { if (flag) first = count; } catch (error: any) { first = error.name; } try { return first + ":" + count; } catch (error: any) { return first + ":" + error.name; } }
console.log("main", look(true), look(false));
