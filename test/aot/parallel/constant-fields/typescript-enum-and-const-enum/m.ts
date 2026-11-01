export enum K { A, B = 5, C }
export const enum Q { X = 1, Y }
export const read = () => [K.A, K.B, K.C, K[5], Q.X, Q.Y].join();
