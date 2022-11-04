Can reference images included here in code comments, ex

```ts
/**
 * ## Large headline
 *
 *
 * **Images** are relative to images/ directory
 *![image_description](media://image_filehere.gif)
 *
 */
export class MyUtil<T = { BOT_TOKEN: string }> {
  constructor(public config: T) {}
}
```
