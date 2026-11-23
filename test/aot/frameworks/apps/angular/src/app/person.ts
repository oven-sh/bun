import { Component, computed, inject, input, RESPONSE_INIT } from "@angular/core";
import { Title } from "@angular/platform-browser";

@Component({
  selector: "app-person",
  template: `@if (isNumber()) {<p>person {{ id() }}, doubled {{ doubled() }}, greeted with {{ greeting() ?? "nothing" }}</p>} @else {<p>no such person</p>}`,
})
export class Person {
  readonly id = input.required<string>();
  readonly greeting = input<string>();
  readonly isNumber = computed(() => /^\d+$/.test(this.id()));
  readonly doubled = computed(() => Number(this.id()) * 2);
  private readonly title = inject(Title);
  private readonly response = inject(RESPONSE_INIT, { optional: true });

  ngOnInit() {
    this.title.setTitle("person " + this.id());
    if (!this.isNumber() && this.response) this.response.status = 404;
  }
}
