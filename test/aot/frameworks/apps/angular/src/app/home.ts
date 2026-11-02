import { Component, signal } from "@angular/core";

@Component({
  selector: "app-home",
  template: `<main>
    <h1>a static page</h1>
    <ul>@for (n of numbers; track n) {<li>{{ n * n }}</li>}</ul>
    <button (click)="count.set(count() + 1)">clicked {{ count() }} times</button>
  </main>`,
})
export class Home {
  readonly numbers = [1, 2, 3];
  readonly count = signal(5);
}
