console.log("levels.ts runs");
export enum Level {
  Low,
  High,
}
export const Levels = { Low: 0, High: 1 } as const;
export const frozen = Object.freeze({ Low: 0, High: 1 });
