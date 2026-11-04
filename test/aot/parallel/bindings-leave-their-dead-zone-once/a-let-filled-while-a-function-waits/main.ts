import "./early";
import { count } from "./a";
export async function waits() { let first; try { first = count; } catch (error: any) { first = error.name; } await new Promise((done) => setTimeout(done, 5)); return first + ":" + count; }
console.log("main");
