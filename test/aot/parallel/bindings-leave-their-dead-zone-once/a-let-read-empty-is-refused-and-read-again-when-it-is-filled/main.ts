import "./early";
import { count } from "./a";
export function look() { let first; try { first = count; } catch (error: any) { first = error.name; } let second; try { second = count; } catch (error: any) { second = error.name; } return first + ":" + second; }
console.log("main", look());
