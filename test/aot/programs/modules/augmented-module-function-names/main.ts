// Another file augments ./shapes with `declare module`. Its exported function and class expressions still get their names from the bindings.
import * as Shapes from './shapes'
import { area, Circle, describe } from './shapes'
import { labelOf } from './labels'

const circle = new Circle(2)
console.log(area.name, Circle.name, describe.name, Shapes.area.name, Shapes.scale.name)
console.log(area(circle).toFixed(3), describe(circle), Shapes.scale(circle, 2).radius, labelOf({ label: 'round' }))
