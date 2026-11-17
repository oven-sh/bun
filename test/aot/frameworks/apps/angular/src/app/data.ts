import { UpperCasePipe } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Component, inject, REQUEST } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";

interface Someone { id: number; name: string }

@Component({
  selector: "app-data",
  imports: [UpperCasePipe],
  template: `<main>
    <h1>a page that awaits data</h1>
    <p>asked by {{ askedBy }}</p>
    <ol>@for (person of people(); track person.id) {<li>{{ person.name | uppercase }}</li>}</ol>
  </main>`,
})
export class Data {
  readonly askedBy = inject(REQUEST, { optional: true })?.headers.get("x-asked-by") ?? "nobody";
  readonly people = toSignal(inject(HttpClient).get<Someone[]>("/api/people"), { initialValue: [] });
}
