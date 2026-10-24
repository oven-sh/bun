export interface Labeled {}
export const Circle = class {
  radius: number
  constructor(radius: number) {
    this.radius = radius
  }
}
type Round = InstanceType<typeof Circle>
export const area: { (shape: Round): number } = (shape: Round) => Math.PI * shape.radius * shape.radius
export const scale = function (shape: Round, by: number): Round {
  return new Circle(shape.radius * by)
}
export const describe = (shape: Round) => `${Circle.name} of ${shape.radius}`
