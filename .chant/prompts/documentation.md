---
name: documentation
purpose: Generate documentation from tracked source files
---

# Documentation Generation

You are generating documentation for {{project.name}}.

## Your Spec

**{{spec.title}}**

{{spec.description}}

## Documentation Process

### 1. Understand the Scope

**Tracked files** (source to document):
- These are the source files you must document
- Read all tracked files completely before writing
- Understand the public interface, types, and patterns

**Target files** (output):
- Documentation file(s) you will create or update
- Match the target format: API docs, architecture docs, README, etc.

### 2. Read and Analyze Tracked Files

1. **Read all tracked files** - Understand the code completely
   - Identify public functions, types, and interfaces
   - Note key patterns and design decisions
   - Understand relationships between components

2. **Identify what to document**
   - Public APIs and their signatures
   - Types, structs, enums, and their fields
   - Module organization and purpose
   - Key abstractions and design patterns

3. **Gather examples** - Find or create usage examples
   - Extract examples from tests
   - Create minimal working examples
   - Show common patterns and edge cases

### 3. Apply Documentation Principles

- **Accurate** — Documentation must match the source exactly
- **Complete** — Document all public interfaces, not a subset
- **Clear** — Write for the target audience (developers, users, etc.)
- **Maintainable** — Structure for easy updates when source changes

### 4. Format Guidelines by Documentation Type

#### API Documentation

For documenting public APIs and interfaces:

```markdown
# Module Name

Brief description of what this module does.

## Overview

Explain the purpose and when to use this module.

## Types

### `TypeName`

Description of the type.

**Fields:**
- `field_name: Type` — Description of field

**Example:**
\```rust
let example = TypeName { field: value };
\```

## Functions

### `function_name(param: Type) -> ReturnType`

Description of what the function does.

**Parameters:**
- `param` — Description of parameter

**Returns:** Description of return value

**Example:**
\```rust
let result = function_name(argument);
\```

**Errors:** When and why it returns errors
```

#### Architecture Documentation

For explaining structure and relationships:

```markdown
# Architecture: Component Name

## Overview

High-level description of the component's purpose.

## Structure

Diagram or description of how parts fit together.

## Key Concepts

### Concept 1

Explanation with examples.

### Concept 2

Explanation with examples.

## Design Decisions

### Decision 1

- **Context**: Why this decision was needed
- **Decision**: What was chosen
- **Consequences**: Trade-offs and implications

## Relationships

How this component interacts with others.
```

#### README / Getting Started

For usage-focused documentation:

```markdown
# Project/Feature Name

Brief description of what it does.

## Installation

How to install or set up.

## Quick Start

Minimal example to get started.

## Usage

### Common Use Case 1

Example and explanation.

### Common Use Case 2

Example and explanation.

## Configuration

Configuration options and their effects.

## Troubleshooting

Common issues and solutions.
```

### 5. Extract Examples from Source

When documenting code:

1. Look for test files — they contain working examples
2. Look for doc comments — they may have examples
3. Look for example files or directories
4. Create minimal examples that compile and run

Include examples that show:
- Basic usage
- Common patterns
- Edge cases (where relevant)
- Error handling

### 6. Verification

Before producing final output:

1. **Accuracy check**: Does every documented item match the source?
2. **Completeness check**: Are all public interfaces documented?
3. **Example check**: Do examples compile/run correctly?
4. **Format check**: Does output match the target file format?
5. **Acceptance criteria check**: Does output meet all stated requirements?

## Constraints

- Read all tracked files before writing
- Document all public interfaces, not just common ones
- Match documentation to actual source, not assumptions
- Include working examples where helpful
- Use the appropriate format for the target audience
- Don't document private/internal implementation details unless specified

## Acceptance Criteria

- [ ] All tracked files read and understood
- [ ] All public interfaces documented
- [ ] Documentation matches actual source exactly
- [ ] Examples are accurate and working
- [ ] Output file(s) created in correct format
- [ ] All acceptance criteria from spec met
- [ ] Commit with message: `chant({{spec.id}}): <documentation summary>`
