// Two files declare the same two record types. Each lays a Proxy into a field of the outer type in a loop: one out of the field of a generic class, one by Object.assign of a spread.
import "./by-object-assign";
import "./by-a-generic-class";
