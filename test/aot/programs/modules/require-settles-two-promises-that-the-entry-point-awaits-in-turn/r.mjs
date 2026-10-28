globalThis.settle(1); console.log('r one'); await Promise.resolve(); console.log('r two'); globalThis.settle2(1); await Promise.resolve(); console.log('r three'); export const a = 1;
