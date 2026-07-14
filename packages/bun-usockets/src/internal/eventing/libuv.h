/*
 * Authored by Alex Hultman, 2018-2019.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef LIBUV_H
#define LIBUV_H

#include "internal/loop_data.h"

#include <uv.h>
#define LIBUS_SOCKET_READABLE UV_READABLE
#define LIBUS_SOCKET_WRITABLE UV_WRITABLE

struct us_loop_t {
  alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

  uv_loop_t *uv_loop;
  int is_default;

  uv_prepare_t *uv_pre;
  uv_check_t *uv_check;
};

// it is no longer valid to cast a pointer to us_poll_t to a pointer of
// uv_poll_t
struct us_poll_t {
  /* We need to hold a pointer to this uv_poll_t since we need to be able to
   * resize our block */
  uv_poll_t *uv_p;
  LIBUS_SOCKET_DESCRIPTOR fd;
  unsigned char poll_type;
};

#endif // LIBUV_H