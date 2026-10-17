class Fixed { declare size: number; constructor(size: number) { this.size = size; } }
Object.defineProperty(Fixed.prototype, "size", { value: 5, writable: false, configurable: true });
export const made = new Fixed(1);
