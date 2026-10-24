import { late } from "./requires-back";
export const SNAPSHOT = (() => { try { return { late: late() }; } catch (error) { return { late: (error as Error).name }; } })();
export const PLAIN = { tried: (() => { try { return late(); } catch (error) { return (error as Error).name; } })() };
