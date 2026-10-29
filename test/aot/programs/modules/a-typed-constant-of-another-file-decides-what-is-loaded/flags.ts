export interface Shape {
  port: number;
}
export const debug: boolean = false;
export const Mode = "fast";
export type Mode = typeof Mode;
export const port = 80 as const;
export const name = "server" satisfies string;
export const cast = 7 as unknown as string;
const limit: number = 10;
export default limit;
