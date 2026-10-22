interface Handler { (value: number): string; (value: string): string }
export const describe: Handler = value => typeof value + ":" + String(value);
