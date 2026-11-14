import { Component, inject, RESPONSE_INIT } from "@angular/core";

@Component({ selector: "app-not-found", template: `<p>a page of our own for what is not found</p>` })
export class NotFound {
  constructor() {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
  }
}
