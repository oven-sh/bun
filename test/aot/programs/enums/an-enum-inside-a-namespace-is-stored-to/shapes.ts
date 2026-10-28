export namespace Shapes {
  export enum Color {
    Red,
    Green = 5,
  }
  export const spoil = () => {
    (Color as any).Green = 9;
  };
}
