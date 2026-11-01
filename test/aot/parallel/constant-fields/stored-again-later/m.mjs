const E = {};
E.A = 0;
E.B = 1;
E.C = 2;
export const read = () => [E.A, E.B, E.C].join();
export const whole = () => E;
export const bump = () => { E.A = 7; };
