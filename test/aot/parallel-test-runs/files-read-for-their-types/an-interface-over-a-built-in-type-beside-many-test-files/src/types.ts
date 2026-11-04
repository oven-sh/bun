declare const raw: unknown;
export class Output { text = ''; }
export interface Later extends Promise<Output> { quiet(): Later; extra: number }
export interface Failure extends Error { extra: number }
