// Instance fields whose computed names are string constants: `readonly [TypeId] = TypeId`. They are own properties in the order
// of their declarations, like fields with written names, and `x[TypeId]` reads them.
const TypeId = '~test/Reason'
const tagName = `${TypeId}/tag` as const
const labelName = 'label'
const errorName = `${TypeId}/error` as const

abstract class Reason<Tag extends string> {
  readonly [TypeId]: typeof TypeId
  readonly first = 1;
  readonly [tagName]: Tag;
  [labelName] = () => 'labelled'
  last: number | undefined
  constructor(tag: Tag) {
    this[TypeId] = TypeId
    this[tagName] = tag
  }
  describe() {
    return this[TypeId] + ' ' + this[tagName] + ' ' + this.first + ' ' + this[labelName].name + ' ' + this.label()
  }
}
class Fail extends Reason<'Fail'> {
  readonly [errorName]: string
  constructor(readonly error: string) {
    super('Fail')
    this[errorName] = error
  }
}

const fail = new Fail('boom')
console.log(Object.keys(fail).join())
console.log(JSON.stringify(fail))
console.log(fail.describe(), fail['~test/Reason/error'], Object.hasOwn(fail, TypeId), TypeId in fail, '~test/Reason/tag' in fail)

let count = 0
for (let i = 0; i < 1000; i++) {
  const each = new Fail('e' + i)
  if (each[TypeId] === TypeId && each[tagName] === 'Fail') count += each.error.length
}
console.log(count)

const hidden: any = fail
delete hidden[tagName]
hidden[tagName] = 'again'
console.log(Object.keys(hidden).join(), hidden.describe())

function makeEarly() {
  return class Early {
    [lateName] = 1
  }
}
try {
  console.log(Object.keys(new (makeEarly())()).join())
} catch (error) {
  console.log((error as Error).name)
}
const lateName = 'late'
console.log(Object.keys(new (makeEarly())()).join())
