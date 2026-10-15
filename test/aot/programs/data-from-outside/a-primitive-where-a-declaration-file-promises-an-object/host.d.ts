export interface Timer { ref(): Timer; unref(): Timer; hasRef(): boolean }
export class Handle { close(): void }
export function startTimer(f: () => void, ms: number): Timer;
export function stopTimer(timer: Timer): void;
export function open(name: string): Handle;
